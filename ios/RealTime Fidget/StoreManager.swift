import SwiftUI
import StoreKit
import CryptoKit
import UIKit
import Security
import Combine

// MARK: - StoreManager
// Free voyage model: everything is free for 60 days from FIRST launch, then a one-time
// $1.99 non-consumable ("unlock forever") gates the whole app. NOT a subscription.
// The first-launch date lives in the Keychain so deleting/reinstalling the app does
// not restart the trial (UserDefaults would).
@MainActor
final class StoreManager: ObservableObject {
    static let productID = "com.nicedreamz.realtimespace.unlock"
    static let trialDays = 60

    @Published var isUnlocked: Bool
    @Published var locked = false            // trial over AND not purchased → hard gate
    @Published var daysRemaining = StoreManager.trialDays
    @Published var product: Product?
    @Published var purchasing = false
    @Published var errorMessage: String?

    private var updatesTask: Task<Void, Never>?

    init() {
        // Fast path so the gate doesn't flash for paid users while StoreKit wakes up.
        // The verified entitlement check below is the real authority.
        isUnlocked = UserDefaults.standard.bool(forKey: "unlockedForever")
            || StoreManager.codeUnlockStored()
        refreshTrial()
        updatesTask = Task { await listenForTransactions() }
        Task {
            await refreshEntitlement()
            await loadProduct()
        }
    }

    // (No deinit — this lives as ContentView's StateObject for the whole app run,
    //  and touching main-actor state from a nonisolated deinit trips Swift concurrency.)

    // Call at launch and whenever the app returns to foreground (day can roll over
    // while backgrounded).
    func refreshTrial() {
        let elapsed = Date().timeIntervalSince(Self.firstLaunchDate())
        daysRemaining = max(0, Self.trialDays - Int(elapsed / 86_400))
        locked = !isUnlocked && daysRemaining <= 0
    }

    // MARK: StoreKit 2

    func loadProduct() async {
        guard product == nil else { return }
        product = try? await Product.products(for: [Self.productID]).first
    }

    func buy() async {
        errorMessage = nil
        if product == nil { await loadProduct() }
        guard let product else {
            errorMessage = "Can't reach the App Store — check your connection and try again."
            return
        }
        purchasing = true
        defer { purchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                if case .verified(let transaction) = verification {
                    await transaction.finish()
                    setUnlocked()
                }
            case .userCancelled, .pending:
                break
            @unknown default:
                break
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restore() async {
        errorMessage = nil
        purchasing = true
        defer { purchasing = false }
        try? await AppStore.sync()
        await refreshEntitlement()
        if !isUnlocked { errorMessage = "No previous purchase found for this Apple Account." }
    }

    // MARK: Unlock codes
    // These are MATT'S OWN codes, not Apple promo codes. Apple's are unreadable 18-character
    // strings you cannot choose, and they only redeem through the App Store app — useless for
    // handing someone a code over the phone or in a forum post. These are short words with one
    // digit, checked right here, offline, no account needed.
    //
    // Stored as SHA-256, and the words themselves are deliberately NOT in this repo — a hash
    // is one-way, a comment naming the code is not. To mint one:
    //   echo -n YOURCODE | shasum -a 256
    // Comparison is case-insensitive and ignores spaces and dashes, so "your code" and
    // "YOUR-CODE" both work.
    private static let codeHashes: Set<String> = [
        "53edfbd29c8559f897047209b58a90e30fae91759a46ec020274001ccd582bcf",  // gift code 1
        "2f48d108f49087a665c016d1006b60a588fa321fa4e5ef8643b1c4957f199d39",  // gift code 2
        "c8c8f7fe625a1a98824e4fc4887ca38b8caeb22ad91c4f40d500c3378549597e",  // owner
    ]

    private static func hash(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Returns true and unlocks the app if the typed code matches. Sets errorMessage otherwise.
    @discardableResult
    func applyUnlockCode(_ raw: String) -> Bool {
        let cleaned = raw.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        guard !cleaned.isEmpty else { return false }
        guard Self.codeHashes.contains(Self.hash(cleaned)) else {
            errorMessage = "That code didn't match. Check it and try again."
            return false
        }
        errorMessage = nil
        Self.storeCodeUnlock()
        setUnlocked()
        return true
    }

    private func refreshEntitlement() async {
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == Self.productID, t.revocationDate == nil {
                setUnlocked()
                return
            }
        }
    }

    private func listenForTransactions() async {
        for await result in Transaction.updates {
            if case .verified(let t) = result, t.productID == Self.productID {
                await t.finish()
                if t.revocationDate == nil { setUnlocked() }
            }
        }
    }

    private func setUnlocked() {
        isUnlocked = true
        locked = false
        UserDefaults.standard.set(true, forKey: "unlockedForever")
    }

    // MARK: Keychain first-launch date

    private static let keychainService = "com.nicedreamz.realtimespace"
    private static let keychainAccount = "firstLaunchDate"

    private static let keychainCodeAccount = "codeUnlocked"

    /// A code unlock lives in the Keychain, not just UserDefaults, for the same reason the
    /// trial date does: deleting and reinstalling the app must not take it away.
    static func codeUnlockStored() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainCodeAccount,
            kSecReturnData as String: true,
        ]
        var item: CFTypeRef?
        return SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess
    }

    static func storeCodeUnlock() {
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainCodeAccount,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: Data("1".utf8),
        ]
        SecItemAdd(add as CFDictionary, nil)
    }

    static func firstLaunchDate() -> Date {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
        ]
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data,
           let str = String(data: data, encoding: .utf8),
           let t = TimeInterval(str) {
            return Date(timeIntervalSince1970: t)
        }
        let now = Date()
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: String(now.timeIntervalSince1970).data(using: .utf8)!,
        ]
        SecItemAdd(add as CFDictionary, nil)
        return now
    }
}

// MARK: - UnlockView
// Shown two ways: as a hard gate when the free voyage ends (onClose == nil, can't be
// dismissed), or opened early from the ⋯ menu (onClose set, X button shows).
struct UnlockView: View {
    @ObservedObject var store: StoreManager
    var onClose: (() -> Void)?

    // Code entry sits on this screen, not behind a trip to the App Store. Matt, 2026-09-12:
    // "it should be like the unlock forever, enter code also on the same screen."
    @State private var codeText = ""
    @State private var showCodeField = false
    @State private var codeAccepted = false
    @FocusState private var codeFocused: Bool

    private func submitCode() {
        if store.applyUnlockCode(codeText) {
            codeAccepted = true
            codeFocused = false
            onClose?()
        }
    }

    var body: some View {
        // A single GeometryReader gives the exact screen size. Every layer is framed to
        // that size, so there is no ambient offset — the content is dead-centered on every
        // device and both orientations. A ScrollView guarantees the CTA is always reachable
        // in landscape, where the height is short.
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let isLandscape = w > h

            ZStack(alignment: .topTrailing) {
                // ---- Cinematic full-bleed backdrop ----
                Image("PaywallBG")
                    .resizable()
                    .scaledToFill()
                    .frame(width: w, height: h)
                    .clipped()

                LinearGradient(
                    colors: [.black.opacity(0.55), .black.opacity(0.25), .black.opacity(0.75)],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(width: w, height: h)

                // ---- Centered content card ----
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 16) {
                        Text("RealTime Space")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)

                        Text(store.daysRemaining > 0
                             ? "\(store.daysRemaining) DAYS LEFT IN YOUR FREE VOYAGE"
                             : "YOUR \(StoreManager.trialDays)-DAY FREE VOYAGE IS COMPLETE")
                            .font(.system(size: 12, weight: .heavy, design: .monospaced))
                            .tracking(1.5)
                            .foregroundStyle(Color.cyan)
                            .multilineTextAlignment(.center)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)

                        Text("Keep the whole universe — every planet, moon, star and view — yours forever.")
                            .font(.system(size: 16, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.92))
                            .multilineTextAlignment(.center)
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)

                        Button {
                            Task { await store.buy() }
                        } label: {
                            HStack(spacing: 8) {
                                if store.purchasing { ProgressView().tint(.black) }
                                Text("Unlock Forever · \(store.product?.displayPrice ?? "$1.99")")
                                    .font(.system(size: 18, weight: .bold, design: .rounded))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                            }
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(
                                Capsule().fill(
                                    LinearGradient(colors: [Color(red: 0.55, green: 0.9, blue: 1.0), .cyan],
                                                   startPoint: .top, endPoint: .bottom)
                                )
                            )
                            .shadow(color: .cyan.opacity(0.5), radius: 16, y: 4)
                        }
                        .disabled(store.purchasing)
                        .padding(.top, 4)

                        Text("No subscription · No ads · One-time purchase")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.6))
                            .multilineTextAlignment(.center)

                        // Restore and Redeem sit together, both reachable from the paywall
                        // itself. Sending someone out to the App Store app to type a code is
                        // bad for everyone and worse with VoiceOver: you lose your place, and
                        // you have to find your way back. Matt, 2026-09-12: "it should be like
                        // the unlock forever, enter code also on the same screen."
                        HStack(spacing: 22) {
                            Button {
                                Task { await store.restore() }
                            } label: {
                                Text("Restore Purchase")
                                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.65))
                                    .underline()
                            }
                            .disabled(store.purchasing)
                            .accessibilityLabel("Restore a purchase you already made")

                            if !showCodeField {
                                Button {
                                    showCodeField = true
                                    codeFocused = true
                                } label: {
                                    Text("Enter a Code")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                        .foregroundStyle(.white.opacity(0.65))
                                        .underline()
                                }
                                .disabled(store.purchasing)
                                .accessibilityLabel("Enter an unlock code")
                            }
                        }

                        // The field itself. One short word, typed here, unlocks the app for good.
                        if showCodeField {
                            HStack(spacing: 10) {
                                TextField("", text: $codeText, prompt:
                                    Text("Your code").foregroundStyle(.white.opacity(0.45)))
                                    .focused($codeFocused)
                                    .textInputAutocapitalization(.characters)
                                    .autocorrectionDisabled()
                                    .submitLabel(.go)
                                    .onSubmit { submitCode() }
                                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white)
                                    .multilineTextAlignment(.center)
                                    .frame(height: 44)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .fill(.white.opacity(0.12))
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .stroke(.white.opacity(0.25), lineWidth: 1)
                                    )
                                    .accessibilityLabel("Unlock code")

                                Button {
                                    submitCode()
                                } label: {
                                    Text("Unlock")
                                        .font(.system(size: 15, weight: .bold, design: .rounded))
                                        .foregroundStyle(.black)
                                        .padding(.horizontal, 18)
                                        .frame(height: 44)
                                        .background(
                                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                                .fill(.cyan)
                                        )
                                }
                                .disabled(codeText.trimmingCharacters(in: .whitespaces).isEmpty)
                                .accessibilityLabel("Unlock with this code")
                            }
                            .padding(.top, 2)
                            .transition(.opacity)
                        }

                        if let error = store.errorMessage {
                            Text(error)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(.orange)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.vertical, 28)
                    .padding(.horizontal, 26)
                    .frame(maxWidth: 420)
                    .background(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .fill(.black.opacity(0.45))
                            .overlay(
                                RoundedRectangle(cornerRadius: 28, style: .continuous)
                                    .stroke(.white.opacity(0.12), lineWidth: 1)
                            )
                    )
                    .padding(.horizontal, 20)
                    // Center the card horizontally, and vertically fill at least the screen
                    // height so short content sits dead-center (portrait) but can scroll (landscape).
                    .frame(maxWidth: .infinity, minHeight: h)
                }
                .frame(width: w, height: h)

                // ---- Close button (only when dismissable) ----
                if let onClose {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white.opacity(0.9))
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(.black.opacity(0.4)))
                    }
                    .padding(.top, isLandscape ? 12 : 24)
                    .padding(.trailing, 20)
                }
            }
            .frame(width: w, height: h)
        }
        .ignoresSafeArea()
        .onChange(of: store.isUnlocked) { _, unlocked in
            if unlocked { onClose?() }
        }
    }
}

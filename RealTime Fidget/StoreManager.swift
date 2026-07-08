import SwiftUI
import StoreKit
import Security
import Combine

// MARK: - StoreManager
// Free voyage model: everything is free for 60 days from FIRST launch, then a one-time
// $0.99 non-consumable ("unlock forever") gates the whole app. NOT a subscription.
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

    var body: some View {
        ZStack {
            // Deep-space backdrop with a faint horizon glow.
            Color.black.ignoresSafeArea()
            RadialGradient(
                colors: [Color(red: 0.05, green: 0.10, blue: 0.22).opacity(0.9), .black],
                center: .bottom, startRadius: 20, endRadius: 600
            )
            .ignoresSafeArea()

            VStack(spacing: 18) {
                Spacer()

                Text("🚀")
                    .font(.system(size: 56))

                Text("RealTime Space")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundColor(.white)

                Group {
                    if store.daysRemaining > 0 {
                        Text("\(store.daysRemaining) days left in your free voyage")
                            .foregroundColor(.cyan)
                    } else {
                        Text("Your \(StoreManager.trialDays)-day free voyage is complete")
                            .foregroundColor(.cyan)
                    }
                }
                .font(.system(size: 15, weight: .semibold, design: .monospaced))

                Text("Keep the whole universe — every planet, moon, star and view — forever. One small purchase, no subscription, no ads.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 36)

                Button {
                    Task { await store.buy() }
                } label: {
                    HStack(spacing: 8) {
                        if store.purchasing { ProgressView().tint(.black) }
                        Text("Unlock Forever · \(store.product?.displayPrice ?? "$0.99")")
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                    }
                    .foregroundColor(.black)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 14)
                    .background(Capsule().fill(Color.cyan))
                }
                .disabled(store.purchasing)
                .padding(.top, 8)

                Button {
                    Task { await store.restore() }
                } label: {
                    Text("Restore Purchase")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundColor(.white.opacity(0.55))
                        .underline()
                }
                .disabled(store.purchasing)

                if let error = store.errorMessage {
                    Text(error)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundColor(.orange)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Spacer()
                Spacer()
            }

            if let onClose {
                VStack {
                    HStack {
                        Spacer()
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.white.opacity(0.7))
                                .frame(width: 40, height: 40)
                                .background(Circle().fill(Color.white.opacity(0.12)))
                        }
                        .padding(.top, 20)
                        .padding(.trailing, 20)
                    }
                    Spacer()
                }
            }
        }
        .onChange(of: store.isUnlocked) { _, unlocked in
            if unlocked { onClose?() }
        }
    }
}

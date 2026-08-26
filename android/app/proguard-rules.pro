# Keep JavascriptInterface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- Play Billing: this app sells a 99c unlock. A silent billing break is the worst
# possible failure, and R8 failures here are silent -- the build succeeds either way.
-keep class com.android.billingclient.api.** { *; }
-dontwarn com.android.billingclient.**
-keep class com.nicedreamz.realtimespace.** { *; }
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

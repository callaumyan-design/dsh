# The app has no reflection-based libraries. Strip all android.util.Log calls from release builds
# so that nothing (in particular SMS content) can ever reach logcat.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
}

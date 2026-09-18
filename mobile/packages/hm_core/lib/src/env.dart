/// Build-time public configuration (`--dart-define`). Never holds secrets.
class HmEnv {
  const HmEnv._();

  /// Android emulator loopback to the host API by default.
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');
  static const appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'development');
}

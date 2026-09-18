import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists only the refresh token. The access token stays in memory.
abstract interface class TokenStore {
  Future<String?> readRefreshToken();
  Future<void> writeRefreshToken(String token);
  Future<void> clear();
}

/// Keychain / Android Keystore-backed storage.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();

  static const _key = 'hm.refresh_token';
  final FlutterSecureStorage _s;

  @override
  Future<String?> readRefreshToken() => _s.read(key: _key);

  @override
  Future<void> writeRefreshToken(String token) => _s.write(key: _key, value: token);

  @override
  Future<void> clear() => _s.delete(key: _key);
}

/// Test double.
class InMemoryTokenStore implements TokenStore {
  String? token;

  @override
  Future<String?> readRefreshToken() async => token;

  @override
  Future<void> writeRefreshToken(String t) async => token = t;

  @override
  Future<void> clear() async => token = null;
}

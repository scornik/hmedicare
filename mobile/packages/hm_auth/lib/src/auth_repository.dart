import 'dart:async';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:hm_api/hm_api.dart' as api;
import 'package:hm_core/hm_core.dart';

import 'token_store.dart';

/// Signed-in user as the UI needs it (no tokens).
class AuthUser {
  const AuthUser({required this.id, this.displayName, this.phoneMasked, this.email});

  final String id;
  final String? displayName;
  final String? phoneMasked;
  final String? email;
}

enum OtpHint { sent, retryLater, mayArrive }

abstract interface class AuthRepository {
  String? get accessToken;
  AuthUser? get user;

  /// Restores a session from the stored refresh token (app start). Returns false when signed out.
  Future<bool> restore();
  Future<OtpHint> requestOtp({required String phoneE164, required String localeTag});
  Future<void> verifyOtp({required String phoneE164, required String code});
  Future<void> passwordLogin({required String email, required String password});

  /// Single-flight: concurrent callers share one refresh.
  Future<bool> refresh();
  Future<void> logout();
}

/// UUIDv4 for `Idempotency-Key` (one per user intent).
String newIdempotencyKey() {
  final r = Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

class HttpAuthRepository implements AuthRepository {
  HttpAuthRepository({
    required api.HmApiClient client,
    required TokenStore store,
    required api.ClientKind clientKind,
  }) : _api = client,
       _tokens = store,
       _client = clientKind;

  final api.HmApiClient _api;
  final TokenStore _tokens;
  final api.ClientKind _client;
  String? _access;
  AuthUser? _user;
  Future<bool>? _inFlight;

  @override
  String? get accessToken => _access;

  @override
  AuthUser? get user => _user;

  Future<void> _establish(api.SessionResponse s) async {
    _access = s.accessToken;
    _user = AuthUser(
      id: s.user.id,
      displayName: s.user.displayName,
      phoneMasked: s.user.phoneMasked,
      email: s.user.email,
    );
    final rt = s.refreshToken;
    if (rt != null) await _tokens.writeRefreshToken(rt);
  }

  Future<T> _call<T>(Future<T> Function() f) async {
    try {
      return await f();
    } on DioException catch (e) {
      throw ApiProblem.fromDio(e);
    }
  }

  @override
  Future<bool> restore() async => (await _tokens.readRefreshToken()) != null && await refresh();

  @override
  Future<OtpHint> requestOtp({required String phoneE164, required String localeTag}) async {
    final r = await _call(
      () => _api.auth.requestOtp(
        idempotencyKey: newIdempotencyKey(),
        body: api.OtpRequestRequest(phone: phoneE164, locale: api.Locale.fromJson(localeTag)),
      ),
    );
    return switch (r.data.hint) {
      api.OtpRequestResponseHint.sent => OtpHint.sent,
      api.OtpRequestResponseHint.mayArrive => OtpHint.mayArrive,
      _ => OtpHint.retryLater,
    };
  }

  @override
  Future<void> verifyOtp({required String phoneE164, required String code}) async {
    final r = await _call(
      () => _api.auth.verifyOtp(
        idempotencyKey: newIdempotencyKey(),
        body: api.OtpVerifyRequest(phone: phoneE164, code: code, client: _client),
      ),
    );
    await _establish(r.data);
  }

  @override
  Future<void> passwordLogin({required String email, required String password}) async {
    final r = await _call(
      () => _api.auth.passwordLogin(
        idempotencyKey: newIdempotencyKey(),
        body: api.PasswordLoginRequest(email: email, password: password, client: _client),
      ),
    );
    await _establish(r.data);
  }

  @override
  Future<bool> refresh() => _inFlight ??= _doRefresh().whenComplete(() => _inFlight = null);

  Future<bool> _doRefresh() async {
    final rt = await _tokens.readRefreshToken();
    if (rt == null) return false;
    try {
      final r = await _api.auth.refreshSession(body: api.RefreshRequest(refreshToken: rt));
      await _establish(r.data);
      return true;
    } on DioException catch (e) {
      // Only a definitive auth failure signs out; a network error keeps the stored token for later.
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) await _clearLocal();
      return false;
    }
  }

  @override
  Future<void> logout() async {
    try {
      if (_access != null) await _api.auth.logout();
    } on DioException {
      // Best effort: local data is cleared regardless.
    } finally {
      await _clearLocal();
    }
  }

  Future<void> _clearLocal() async {
    _access = null;
    _user = null;
    await _tokens.clear();
  }
}

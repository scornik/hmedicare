import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart' as api;
import 'package:hm_core/hm_core.dart';

import 'auth_interceptor.dart';
import 'auth_repository.dart';
import 'token_store.dart';

/// Wiring for an app: Dio (bearer only) → generated client → repository.
class AuthWiring {
  AuthWiring({required api.ClientKind clientKind, TokenStore? store, String baseUrl = HmEnv.apiBaseUrl}) {
    final dio = api.createHmDio(baseUrl: baseUrl);
    client = api.HmApiClient(dio);
    repository = HttpAuthRepository(
      client: client,
      store: store ?? SecureTokenStore(),
      clientKind: clientKind,
    );
    dio.interceptors.add(AuthInterceptor(dio: dio, repository: () => repository));
  }

  late final api.HmApiClient client;
  late final AuthRepository repository;
}

/// Overridden per app (and in tests).
final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => throw UnimplementedError('override authRepositoryProvider'),
);
final apiClientProvider = Provider<api.HmApiClient>(
  (ref) => throw UnimplementedError('override apiClientProvider'),
);

enum AuthStatus { unknown, signedOut, signedIn }

class AuthState {
  const AuthState(this.status, [this.user]);

  final AuthStatus status;
  final AuthUser? user;
}

/// UI-facing auth state. Routing on it is UX only; the API authorizes every call.
class AuthController extends Notifier<AuthState> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  AuthState build() {
    Future.microtask(_restore);
    return const AuthState(AuthStatus.unknown);
  }

  Future<void> _restore() async {
    final ok = await _repo.restore();
    state = ok ? AuthState(AuthStatus.signedIn, _repo.user) : const AuthState(AuthStatus.signedOut);
  }

  Future<OtpHint> requestOtp(String phoneE164, String localeTag) =>
      _repo.requestOtp(phoneE164: phoneE164, localeTag: localeTag);

  Future<void> verifyOtp(String phoneE164, String code) async {
    await _repo.verifyOtp(phoneE164: phoneE164, code: code);
    state = AuthState(AuthStatus.signedIn, _repo.user);
  }

  Future<void> passwordLogin(String email, String password) async {
    await _repo.passwordLogin(email: email, password: password);
    state = AuthState(AuthStatus.signedIn, _repo.user);
  }

  Future<void> logout() async {
    await _repo.logout();
    state = const AuthState(AuthStatus.signedOut);
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);

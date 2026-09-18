import 'package:dio/dio.dart';

import 'auth_repository.dart';

/// Adds `Authorization: Bearer` and retries once after a single-flight refresh on 401.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({required this.dio, required this.repository, this.onSignedOut});

  final Dio dio;
  final AuthRepository Function() repository;
  final void Function()? onSignedOut;

  static const _retried = 'hm.retried';
  static bool _isAuthPath(String p) => p.contains('/api/v1/auth/');

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = repository().accessToken;
    final isRefresh = options.path.endsWith('/auth/session/refresh');
    if (token != null && !isRefresh) options.headers['authorization'] = 'Bearer $token';
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final o = err.requestOptions;
    if (err.response?.statusCode != 401 || o.extra[_retried] == true || _isAuthPath(o.path)) {
      return handler.next(err);
    }
    if (!await repository().refresh()) {
      onSignedOut?.call();
      return handler.next(err);
    }
    o.extra[_retried] = true;
    o.headers['authorization'] = 'Bearer ${repository().accessToken}';
    try {
      handler.resolve(await dio.fetch<dynamic>(o));
    } on DioException catch (e) {
      handler.next(e);
    }
  }
}

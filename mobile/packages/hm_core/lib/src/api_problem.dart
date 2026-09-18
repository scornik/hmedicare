import 'package:dio/dio.dart';

/// ProblemDetails from the API (`{code, message, requestId, retryAfterSeconds?}`), or a transport failure.
class ApiProblem implements Exception {
  const ApiProblem({required this.code, this.status, this.requestId, this.retryAfterSeconds});

  /// Maps a Dio failure. Only the stable `code` is kept; server messages are not shown verbatim.
  factory ApiProblem.fromDio(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['code'] is String) {
      return ApiProblem(
        code: data['code'] as String,
        status: e.response?.statusCode,
        requestId: data['requestId'] as String?,
        retryAfterSeconds: (data['retryAfterSeconds'] as num?)?.toInt(),
      );
    }
    final offline =
        e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout;
    return ApiProblem(
      code: offline ? 'NETWORK_UNAVAILABLE' : 'INTERNAL_ERROR',
      status: e.response?.statusCode,
    );
  }

  final String code;
  final int? status;
  final String? requestId;
  final int? retryAfterSeconds;

  bool get isUnauthenticated => status == 401;
  bool get isSessionRevoked => code == 'SESSION_REVOKED';

  @override
  String toString() => 'ApiProblem($code, status: $status, requestId: $requestId)';
}

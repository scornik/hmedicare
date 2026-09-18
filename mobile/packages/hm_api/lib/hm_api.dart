/// HMedic API client: the swagger_parser output under `generated/` (never edited by hand) plus a Dio factory.
library;

import 'package:dio/dio.dart';

export 'generated/export.dart';

/// Dio configured for the HMedic API. Bearer-only transport: no cookie jar is ever attached (ADR-013 §2).
Dio createHmDio({required String baseUrl, Iterable<Interceptor> interceptors = const []}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      contentType: Headers.jsonContentType,
      responseType: ResponseType.json,
      headers: {'accept': 'application/json'},
    ),
  );
  dio.interceptors.addAll(interceptors);
  return dio;
}

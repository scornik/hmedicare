// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'documents_client.dart';

// dart format off

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element,unnecessary_string_interpolations,unused_element_parameter,avoid_unused_constructor_parameters,unreachable_from_main,avoid_redundant_argument_values

class _DocumentsClient implements DocumentsClient {
  _DocumentsClient(this._dio, {this.baseUrl, this.errorLogger});

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<GetApiV1DocumentsByEncounterEncounterIdResponse>
  listEncounterDocuments({
    required String encounterId,
    required String xTenantId,
    int? page,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{r'page': page};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{r'X-Tenant-ID': xTenantId};
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options =
        _setStreamType<GetApiV1DocumentsByEncounterEncounterIdResponse>(
          Options(method: 'GET', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/documents/by-encounter/${encounterId}',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late GetApiV1DocumentsByEncounterEncounterIdResponse _value;
    try {
      _value = GetApiV1DocumentsByEncounterEncounterIdResponse.fromJson(
        _result.data!,
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<GetApiV1DocumentsPatientUploadEncountersResponse>
  listPatientUploadEncounters({
    required String xTenantId,
    required String xPatientContext,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options =
        _setStreamType<GetApiV1DocumentsPatientUploadEncountersResponse>(
          Options(method: 'GET', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/documents/patient/upload-encounters',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late GetApiV1DocumentsPatientUploadEncountersResponse _value;
    try {
      _value = GetApiV1DocumentsPatientUploadEncountersResponse.fromJson(
        _result.data!,
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<GetApiV1DocumentsUploadCapabilityResponse>
  getDocumentUploadCapability({
    required String xTenantId,
    String? xPatientContext,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<GetApiV1DocumentsUploadCapabilityResponse>(
      Options(method: 'GET', headers: _headers, extra: _extra)
          .compose(
            _dio.options,
            '/api/v1/documents/upload-capability',
            queryParameters: queryParameters,
            data: _data,
          )
          .copyWith(baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl)),
    );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late GetApiV1DocumentsUploadCapabilityResponse _value;
    try {
      _value = GetApiV1DocumentsUploadCapabilityResponse.fromJson(
        _result.data!,
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PostApiV1DocumentsUploadSessionsResponse> createDocumentUploadSession({
    required String xTenantId,
    required String idempotencyKey,
    String? xPatientContext,
    DocumentUploadRequest? body,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'Idempotency-Key': idempotencyKey,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    final _data = <String, dynamic>{};
    _data.addAll(body?.toJson() ?? <String, dynamic>{});
    final _options = _setStreamType<PostApiV1DocumentsUploadSessionsResponse>(
      Options(method: 'POST', headers: _headers, extra: _extra)
          .compose(
            _dio.options,
            '/api/v1/documents/upload-sessions',
            queryParameters: queryParameters,
            data: _data,
          )
          .copyWith(baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl)),
    );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late PostApiV1DocumentsUploadSessionsResponse _value;
    try {
      _value = PostApiV1DocumentsUploadSessionsResponse.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PostApiV1DocumentsUploadSessionsSessionIdAbortResponse>
  abortDocumentUpload({
    required String sessionId,
    required String xTenantId,
    required String idempotencyKey,
    String? xPatientContext,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'Idempotency-Key': idempotencyKey,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options =
        _setStreamType<PostApiV1DocumentsUploadSessionsSessionIdAbortResponse>(
          Options(method: 'POST', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/documents/upload-sessions/${sessionId}/abort',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late PostApiV1DocumentsUploadSessionsSessionIdAbortResponse _value;
    try {
      _value = PostApiV1DocumentsUploadSessionsSessionIdAbortResponse.fromJson(
        _result.data!,
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse>
  finalizeDocumentUpload({
    required String sessionId,
    required String xTenantId,
    required String idempotencyKey,
    String? xPatientContext,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'Idempotency-Key': idempotencyKey,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options =
        _setStreamType<
          PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse
        >(
          Options(method: 'POST', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/documents/upload-sessions/${sessionId}/finalize',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse _value;
    try {
      _value =
          PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse.fromJson(
            _result.data!,
          );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse>
  uploadDocumentPart({
    required String sessionId,
    required int partNumber,
    required String xTenantId,
    required String xPartSha256,
    String? xPatientContext,
    File? body,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'X-Part-SHA256': xPartSha256,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    final _data = body.openRead();
    final _options =
        _setStreamType<
          PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse
        >(
          Options(method: 'PUT', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/documents/upload-sessions/${sessionId}/parts/${partNumber}',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse _value;
    try {
      _value =
          PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse.fromJson(
            _result.data!,
          );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<GetApiV1DocumentsIdResponse> getDocumentMetadata({
    required String id,
    required String xTenantId,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{r'X-Tenant-ID': xTenantId};
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<GetApiV1DocumentsIdResponse>(
      Options(method: 'GET', headers: _headers, extra: _extra)
          .compose(
            _dio.options,
            '/api/v1/documents/${id}',
            queryParameters: queryParameters,
            data: _data,
          )
          .copyWith(baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl)),
    );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late GetApiV1DocumentsIdResponse _value;
    try {
      _value = GetApiV1DocumentsIdResponse.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Stream<String> downloadDocument({
    required String id,
    required String token,
    required String xTenantId,
    String? xPatientContext,
  }) async* {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{r'token': token};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<String>(
      Options(
            method: 'GET',
            headers: _headers,
            extra: _extra,
            responseType: ResponseType.stream,
          )
          .compose(
            _dio.options,
            '/api/v1/documents/${id}/download',
            queryParameters: queryParameters,
            data: _data,
          )
          .copyWith(baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl)),
    );
    final _result = _dio.fetch<ResponseBody>(_options);
    final _value = _result.asStream().asyncExpand(
      (response) => utf8.decoder.bind(response.data!.stream),
    );
    yield* _value;
  }

  @override
  Future<PostApiV1DocumentsIdDownloadTokenResponse>
  createDocumentDownloadToken({
    required String id,
    required String xTenantId,
    required String idempotencyKey,
    String? xPatientContext,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'Idempotency-Key': idempotencyKey,
      r'X-Patient-Context': xPatientContext,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<PostApiV1DocumentsIdDownloadTokenResponse>(
      Options(method: 'POST', headers: _headers, extra: _extra)
          .compose(
            _dio.options,
            '/api/v1/documents/${id}/download-token',
            queryParameters: queryParameters,
            data: _data,
          )
          .copyWith(baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl)),
    );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late PostApiV1DocumentsIdDownloadTokenResponse _value;
    try {
      _value = PostApiV1DocumentsIdDownloadTokenResponse.fromJson(
        _result.data!,
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  RequestOptions _setStreamType<T>(RequestOptions requestOptions) {
    if (T != dynamic &&
        !(requestOptions.responseType == ResponseType.bytes ||
            requestOptions.responseType == ResponseType.stream)) {
      if (T == String) {
        requestOptions.responseType = ResponseType.plain;
      } else {
        requestOptions.responseType = ResponseType.json;
      }
    }
    return requestOptions;
  }

  String _combineBaseUrls(String dioBaseUrl, String? baseUrl) {
    if (baseUrl == null || baseUrl.trim().isEmpty) {
      return dioBaseUrl;
    }

    final url = Uri.parse(baseUrl);

    if (url.isAbsolute) {
      return url.toString();
    }

    return Uri.parse(dioBaseUrl).resolveUri(url).toString();
  }
}

// dart format on

// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'communication_client.dart';

// dart format off

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element,unnecessary_string_interpolations,unused_element_parameter,avoid_unused_constructor_parameters,unreachable_from_main,avoid_redundant_argument_values

class _CommunicationClient implements CommunicationClient {
  _CommunicationClient(this._dio, {this.baseUrl, this.errorLogger});

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<GetApiV1PatientsIdCommunicationPreferencesResponse>
  listCommunicationPreferences({
    required String id,
    String? xTenantId,
    String? xPatientContext,
    String? idempotencyKey,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'X-Patient-Context': xPatientContext,
      r'Idempotency-Key': idempotencyKey,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options =
        _setStreamType<GetApiV1PatientsIdCommunicationPreferencesResponse>(
          Options(method: 'GET', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/patients/${id}/communication-preferences',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late GetApiV1PatientsIdCommunicationPreferencesResponse _value;
    try {
      _value = GetApiV1PatientsIdCommunicationPreferencesResponse.fromJson(
        _result.data!,
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PutApiV1PatientsIdCommunicationPreferencesResponse>
  setCommunicationPreference({
    required String id,
    String? xTenantId,
    String? xPatientContext,
    String? idempotencyKey,
    ApiV1PatientsIdCommunicationPreferencesRequestBody? body,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'X-Patient-Context': xPatientContext,
      r'Idempotency-Key': idempotencyKey,
    };
    _headers.removeWhere((k, v) => v == null);
    final _data = <String, dynamic>{};
    _data.addAll(body?.toJson() ?? <String, dynamic>{});
    final _options =
        _setStreamType<PutApiV1PatientsIdCommunicationPreferencesResponse>(
          Options(method: 'PUT', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/patients/${id}/communication-preferences',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late PutApiV1PatientsIdCommunicationPreferencesResponse _value;
    try {
      _value = PutApiV1PatientsIdCommunicationPreferencesResponse.fromJson(
        _result.data!,
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<GetApiV1PatientsIdCommunicationsResponse> listPatientCommunications({
    required String id,
    String? xTenantId,
    String? xPatientContext,
    String? idempotencyKey,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{
      r'X-Tenant-ID': xTenantId,
      r'X-Patient-Context': xPatientContext,
      r'Idempotency-Key': idempotencyKey,
    };
    _headers.removeWhere((k, v) => v == null);
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<GetApiV1PatientsIdCommunicationsResponse>(
      Options(method: 'GET', headers: _headers, extra: _extra)
          .compose(
            _dio.options,
            '/api/v1/patients/${id}/communications',
            queryParameters: queryParameters,
            data: _data,
          )
          .copyWith(baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl)),
    );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late GetApiV1PatientsIdCommunicationsResponse _value;
    try {
      _value = GetApiV1PatientsIdCommunicationsResponse.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options, response: _result);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PostApiV1WebhooksCommunicationProviderAdapterResponse>
  receiveCommunicationWebhook({
    required CommunicationWebhookAdapter providerAdapter,
    required String xMockSignature,
    ApiV1WebhooksCommunicationProviderAdapterRequestBody? body,
  }) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{r'x-mock-signature': xMockSignature};
    _headers.removeWhere((k, v) => v == null);
    final _data = <String, dynamic>{};
    _data.addAll(body?.toJson() ?? <String, dynamic>{});
    final _options =
        _setStreamType<PostApiV1WebhooksCommunicationProviderAdapterResponse>(
          Options(method: 'POST', headers: _headers, extra: _extra)
              .compose(
                _dio.options,
                '/api/v1/webhooks/communication/${providerAdapter.toJson()}',
                queryParameters: queryParameters,
                data: _data,
              )
              .copyWith(
                baseUrl: _combineBaseUrls(_dio.options.baseUrl, baseUrl),
              ),
        );
    final _result = await _dio.fetch<Map<String, Object?>>(_options);
    late PostApiV1WebhooksCommunicationProviderAdapterResponse _value;
    try {
      _value = PostApiV1WebhooksCommunicationProviderAdapterResponse.fromJson(
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

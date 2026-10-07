// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/post_api_v1_documents_id_download_token_response.dart';

part 'documents_client.g.dart';

@RestApi()
abstract class DocumentsClient {
  factory DocumentsClient(Dio dio, {String? baseUrl}) = _DocumentsClient;

  /// Streams the revision the token was issued for. The token is spent on use, so a saved link does not work twice, and every rejection answers identically so a caller cannot probe for a valid one.
  @GET('/api/v1/documents/{id}/download')
  @DioResponseType(ResponseType.stream)
  Stream<String> downloadDocument({
    @Path('id') required String id,
    @Query('token') required String token,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Re-checks authorization and returns a single-use token for the current revision. Refused with DOCUMENT_NOT_AVAILABLE unless the document is AVAILABLE.
  @POST('/api/v1/documents/{id}/download-token')
  Future<PostApiV1DocumentsIdDownloadTokenResponse> createDocumentDownloadToken({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });
}

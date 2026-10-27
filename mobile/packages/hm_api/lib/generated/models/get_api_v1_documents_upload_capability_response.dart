// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data3.dart';
import 'response_meta.dart';

part 'get_api_v1_documents_upload_capability_response.g.dart';

@JsonSerializable()
class GetApiV1DocumentsUploadCapabilityResponse {
  const GetApiV1DocumentsUploadCapabilityResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DocumentsUploadCapabilityResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DocumentsUploadCapabilityResponseFromJson(json);
  
  final Data3 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DocumentsUploadCapabilityResponseToJson(this);
}

// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'csrf_response.g.dart';

@JsonSerializable()
class CsrfResponse {
  const CsrfResponse({
    required this.csrfToken,
  });
  
  factory CsrfResponse.fromJson(Map<String, Object?> json) => _$CsrfResponseFromJson(json);
  
  final String csrfToken;

  Map<String, Object?> toJson() => _$CsrfResponseToJson(this);
}

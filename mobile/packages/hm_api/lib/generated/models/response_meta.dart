// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'response_meta.g.dart';

@JsonSerializable()
class ResponseMeta {
  const ResponseMeta({
    required this.requestId,
    this.replayed,
  });
  
  factory ResponseMeta.fromJson(Map<String, Object?> json) => _$ResponseMetaFromJson(json);
  
  /// true when this response is an idempotent replay
  final bool? replayed;
  final String requestId;

  Map<String, Object?> toJson() => _$ResponseMetaToJson(this);
}

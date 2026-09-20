// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'row_version_only_request.g.dart';

@JsonSerializable()
class RowVersionOnlyRequest {
  const RowVersionOnlyRequest({
    required this.expectedRowVersion,
  });
  
  factory RowVersionOnlyRequest.fromJson(Map<String, Object?> json) => _$RowVersionOnlyRequestFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$RowVersionOnlyRequestToJson(this);
}

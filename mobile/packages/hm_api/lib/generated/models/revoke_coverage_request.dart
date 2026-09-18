// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'revoke_coverage_request.g.dart';

@JsonSerializable()
class RevokeCoverageRequest {
  const RevokeCoverageRequest({
    required this.expectedRowVersion,
  });
  
  factory RevokeCoverageRequest.fromJson(Map<String, Object?> json) => _$RevokeCoverageRequestFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$RevokeCoverageRequestToJson(this);
}

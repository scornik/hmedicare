// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'create_merge_case_request.g.dart';

@JsonSerializable()
class CreateMergeCaseRequest {
  const CreateMergeCaseRequest({
    required this.reason,
    required this.targetPatientId,
  });
  
  factory CreateMergeCaseRequest.fromJson(Map<String, Object?> json) => _$CreateMergeCaseRequestFromJson(json);
  
  final String reason;
  final String targetPatientId;

  Map<String, Object?> toJson() => _$CreateMergeCaseRequestToJson(this);
}

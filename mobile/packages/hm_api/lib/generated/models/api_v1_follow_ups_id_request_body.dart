// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'follow_up_terminal_status.dart';

part 'api_v1_follow_ups_id_request_body.g.dart';

@JsonSerializable()
class ApiV1FollowUpsIdRequestBody {
  const ApiV1FollowUpsIdRequestBody({
    required this.expectedRowVersion,
    this.dueEndDate,
    this.dueStartDate,
    this.instructions,
    this.reason,
    this.status,
  });
  
  factory ApiV1FollowUpsIdRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1FollowUpsIdRequestBodyFromJson(json);
  
  final String? dueEndDate;
  final String? dueStartDate;
  final int expectedRowVersion;
  final String? instructions;
  final String? reason;
  final FollowUpTerminalStatus? status;

  Map<String, Object?> toJson() => _$ApiV1FollowUpsIdRequestBodyToJson(this);
}

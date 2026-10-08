// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'care_mode.dart';

part 'api_v1_follow_ups_id_book_request_body.g.dart';

@JsonSerializable()
class ApiV1FollowUpsIdBookRequestBody {
  const ApiV1FollowUpsIdBookRequestBody({
    required this.careMode,
    required this.chamberId,
    required this.expectedRowVersion,
    required this.localDate,
    this.slotId,
  });
  
  factory ApiV1FollowUpsIdBookRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1FollowUpsIdBookRequestBodyFromJson(json);
  
  final CareMode careMode;
  final String chamberId;
  final int expectedRowVersion;
  final String localDate;
  final String? slotId;

  Map<String, Object?> toJson() => _$ApiV1FollowUpsIdBookRequestBodyToJson(this);
}

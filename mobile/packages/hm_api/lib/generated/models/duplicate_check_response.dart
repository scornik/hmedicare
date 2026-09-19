// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'duplicate_candidate.dart';

part 'duplicate_check_response.g.dart';

@JsonSerializable()
class DuplicateCheckResponse {
  const DuplicateCheckResponse({
    required this.candidates,
    required this.reviewRequired,
  });
  
  factory DuplicateCheckResponse.fromJson(Map<String, Object?> json) => _$DuplicateCheckResponseFromJson(json);
  
  final List<DuplicateCandidate> candidates;
  final bool reviewRequired;

  Map<String, Object?> toJson() => _$DuplicateCheckResponseToJson(this);
}

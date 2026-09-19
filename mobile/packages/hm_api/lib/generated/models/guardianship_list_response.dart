// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'guardianship.dart';

part 'guardianship_list_response.g.dart';

@JsonSerializable()
class GuardianshipListResponse {
  const GuardianshipListResponse({
    required this.hasMore,
    required this.items,
    required this.nextCursor,
  });
  
  factory GuardianshipListResponse.fromJson(Map<String, Object?> json) => _$GuardianshipListResponseFromJson(json);
  
  final bool hasMore;
  final List<Guardianship> items;
  final String? nextCursor;

  Map<String, Object?> toJson() => _$GuardianshipListResponseToJson(this);
}

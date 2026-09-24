// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'search_medications_query.g.dart';

@JsonSerializable()
class SearchMedicationsQuery {
  const SearchMedicationsQuery({
    required this.q,
    this.limit,
  });
  
  factory SearchMedicationsQuery.fromJson(Map<String, Object?> json) => _$SearchMedicationsQueryFromJson(json);
  
  final int? limit;
  final String q;

  Map<String, Object?> toJson() => _$SearchMedicationsQueryToJson(this);
}

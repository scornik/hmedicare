// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'sections.g.dart';

@JsonSerializable()
class Sections {
  const Sections({
    this.assessment,
    this.chiefComplaint,
    this.examination,
    this.history,
    this.plan,
  });
  
  factory Sections.fromJson(Map<String, Object?> json) => _$SectionsFromJson(json);
  
  final String? assessment;
  final String? chiefComplaint;
  final String? examination;
  final String? history;
  final String? plan;

  Map<String, Object?> toJson() => _$SectionsToJson(this);
}

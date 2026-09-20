// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'counts2.g.dart';

@JsonSerializable()
class Counts2 {
  const Counts2({
    required this.called,
    required this.completed,
    required this.inConsultation,
    required this.totalSerials,
    required this.waiting,
  });
  
  factory Counts2.fromJson(Map<String, Object?> json) => _$Counts2FromJson(json);
  
  final int called;
  final int completed;
  final int inConsultation;
  final int totalSerials;
  final int waiting;

  Map<String, Object?> toJson() => _$Counts2ToJson(this);
}

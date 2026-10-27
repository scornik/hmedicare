// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'lab_report_view.dart';

part 'data7.g.dart';

@JsonSerializable()
class Data7 {
  const Data7({
    required this.items,
  });
  
  factory Data7.fromJson(Map<String, Object?> json) => _$Data7FromJson(json);
  
  final List<LabReportView> items;

  Map<String, Object?> toJson() => _$Data7ToJson(this);
}

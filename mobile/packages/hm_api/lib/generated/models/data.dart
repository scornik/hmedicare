// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'lab_report_view.dart';
import 'lab_result_view.dart';

part 'data.g.dart';

@JsonSerializable()
class Data {
  const Data();
  
  factory Data.fromJson(Map<String, Object?> json) => _$DataFromJson(json);
  
  Map<String, Object?> toJson() => _$DataToJson(this);
}

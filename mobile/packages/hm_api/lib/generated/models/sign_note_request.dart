// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'sign_note_request.g.dart';

@JsonSerializable()
class SignNoteRequest {
  const SignNoteRequest({
    required this.expectedRowVersion,
  });
  
  factory SignNoteRequest.fromJson(Map<String, Object?> json) => _$SignNoteRequestFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$SignNoteRequestToJson(this);
}

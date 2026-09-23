// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'amend_note_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AmendNoteRequest _$AmendNoteRequestFromJson(Map<String, dynamic> json) =>
    AmendNoteRequest(
      correctionReason: json['correctionReason'] as String,
      expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
    );

Map<String, dynamic> _$AmendNoteRequestToJson(AmendNoteRequest instance) =>
    <String, dynamic>{
      'correctionReason': instance.correctionReason,
      'expectedRowVersion': instance.expectedRowVersion,
    };

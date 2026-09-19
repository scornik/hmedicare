// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_search_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientSearchResponse _$PatientSearchResponseFromJson(
  Map<String, dynamic> json,
) => PatientSearchResponse(
  hasMore: json['hasMore'] as bool,
  items: (json['items'] as List<dynamic>)
      .map((e) => PatientSummary.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['nextCursor'] as String?,
);

Map<String, dynamic> _$PatientSearchResponseToJson(
  PatientSearchResponse instance,
) => <String, dynamic>{
  'hasMore': instance.hasMore,
  'items': instance.items,
  'nextCursor': ?instance.nextCursor,
};

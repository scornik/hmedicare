// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'duplicate_check_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DuplicateCheckResponse _$DuplicateCheckResponseFromJson(
  Map<String, dynamic> json,
) => DuplicateCheckResponse(
  candidates: (json['candidates'] as List<dynamic>)
      .map((e) => DuplicateCandidate.fromJson(e as Map<String, dynamic>))
      .toList(),
  reviewRequired: json['reviewRequired'] as bool,
);

Map<String, dynamic> _$DuplicateCheckResponseToJson(
  DuplicateCheckResponse instance,
) => <String, dynamic>{
  'candidates': instance.candidates,
  'reviewRequired': instance.reviewRequired,
};

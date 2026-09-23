// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sections.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Sections _$SectionsFromJson(Map<String, dynamic> json) => Sections(
  assessment: json['assessment'] as String?,
  chiefComplaint: json['chiefComplaint'] as String?,
  examination: json['examination'] as String?,
  history: json['history'] as String?,
  plan: json['plan'] as String?,
);

Map<String, dynamic> _$SectionsToJson(Sections instance) => <String, dynamic>{
  'assessment': ?instance.assessment,
  'chiefComplaint': ?instance.chiefComplaint,
  'examination': ?instance.examination,
  'history': ?instance.history,
  'plan': ?instance.plan,
};

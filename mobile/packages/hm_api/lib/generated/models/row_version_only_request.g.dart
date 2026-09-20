// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'row_version_only_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RowVersionOnlyRequest _$RowVersionOnlyRequestFromJson(
  Map<String, dynamic> json,
) => RowVersionOnlyRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
);

Map<String, dynamic> _$RowVersionOnlyRequestToJson(
  RowVersionOnlyRequest instance,
) => <String, dynamic>{'expectedRowVersion': instance.expectedRowVersion};

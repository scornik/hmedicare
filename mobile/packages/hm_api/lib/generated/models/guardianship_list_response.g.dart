// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'guardianship_list_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GuardianshipListResponse _$GuardianshipListResponseFromJson(
  Map<String, dynamic> json,
) => GuardianshipListResponse(
  hasMore: json['hasMore'] as bool,
  items: (json['items'] as List<dynamic>)
      .map((e) => Guardianship.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['nextCursor'] as String?,
);

Map<String, dynamic> _$GuardianshipListResponseToJson(
  GuardianshipListResponse instance,
) => <String, dynamic>{
  'hasMore': instance.hasMore,
  'items': instance.items,
  'nextCursor': ?instance.nextCursor,
};

// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'search_medications_query.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SearchMedicationsQuery _$SearchMedicationsQueryFromJson(
  Map<String, dynamic> json,
) => SearchMedicationsQuery(
  q: json['q'] as String,
  limit: (json['limit'] as num?)?.toInt(),
);

Map<String, dynamic> _$SearchMedicationsQueryToJson(
  SearchMedicationsQuery instance,
) => <String, dynamic>{'limit': ?instance.limit, 'q': instance.q};

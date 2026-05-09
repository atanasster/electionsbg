import { useTranslation } from "react-i18next";
import type { CensusEntity } from "@/data/census/censusTypes";
import { StackedBar, StackedBarSlice } from "./StackedBar";

const ETHNIC_COLORS = {
  bulgarian: "hsl(213, 70%, 55%)",
  turkish: "hsl(20, 75%, 55%)",
  roma: "hsl(280, 60%, 55%)",
  other: "hsl(40, 75%, 55%)",
  unknown: "hsl(0, 0%, 70%)",
};

const RELIGION_COLORS = {
  christian: "hsl(213, 70%, 55%)",
  muslim: "hsl(140, 55%, 45%)",
  jewish: "hsl(50, 90%, 55%)",
  other: "hsl(40, 75%, 55%)",
  noReligion: "hsl(0, 0%, 50%)",
  unknown: "hsl(0, 0%, 70%)",
};

const EDUCATION_COLORS = {
  tertiary: "hsl(213, 70%, 50%)",
  upperSecondary: "hsl(200, 60%, 60%)",
  lowerSecondary: "hsl(40, 75%, 55%)",
  primaryOrLower: "hsl(15, 75%, 55%)",
  preSchool: "hsl(0, 0%, 70%)",
};

const AGE_COLORS = [
  "hsl(140, 55%, 45%)",
  "hsl(180, 50%, 45%)",
  "hsl(213, 70%, 50%)",
  "hsl(280, 50%, 50%)",
  "hsl(340, 60%, 50%)",
];

const GENDER_COLORS = {
  male: "hsl(213, 70%, 55%)",
  female: "hsl(340, 60%, 60%)",
};

export const CountryBreakdown: React.FC<{
  entity: CensusEntity;
  // Heading mode: full = include all dimensions; compact = drop age + gender
  // for region pages where space is tight.
  compact?: boolean;
}> = ({ entity, compact }) => {
  const { t } = useTranslation();

  const ethnicSlices: StackedBarSlice[] = entity.ethnic
    ? [
        {
          key: "bulgarian",
          label: t("census_metric_ethnic_bulgarian"),
          value: entity.ethnic.bulgarian,
          color: ETHNIC_COLORS.bulgarian,
        },
        {
          key: "turkish",
          label: t("census_metric_ethnic_turkish"),
          value: entity.ethnic.turkish,
          color: ETHNIC_COLORS.turkish,
        },
        {
          key: "roma",
          label: t("census_metric_ethnic_roma"),
          value: entity.ethnic.roma,
          color: ETHNIC_COLORS.roma,
        },
        {
          key: "other",
          label: t("census_other"),
          value: entity.ethnic.other,
          color: ETHNIC_COLORS.other,
        },
        {
          key: "unknown",
          label: t("census_undeclared"),
          value:
            entity.ethnic.cantDetermine +
            entity.ethnic.dontWantAnswer +
            entity.ethnic.unknown,
          color: ETHNIC_COLORS.unknown,
        },
      ]
    : [];

  const religionSlices: StackedBarSlice[] = entity.religion
    ? [
        {
          key: "christian",
          label: t("census_metric_religion_christian"),
          value: entity.religion.christian,
          color: RELIGION_COLORS.christian,
        },
        {
          key: "muslim",
          label: t("census_metric_religion_muslim"),
          value: entity.religion.muslim,
          color: RELIGION_COLORS.muslim,
        },
        {
          key: "jewish",
          label: t("census_religion_jewish"),
          value: entity.religion.jewish,
          color: RELIGION_COLORS.jewish,
        },
        {
          key: "other",
          label: t("census_other"),
          value: entity.religion.other,
          color: RELIGION_COLORS.other,
        },
        {
          key: "noReligion",
          label: t("census_metric_religion_none"),
          value: entity.religion.noReligion,
          color: RELIGION_COLORS.noReligion,
        },
        {
          key: "unknown",
          label: t("census_undeclared"),
          value:
            entity.religion.cantDetermine +
            entity.religion.dontWantAnswer +
            entity.religion.unknown,
          color: RELIGION_COLORS.unknown,
        },
      ]
    : [];

  const educationSlices: StackedBarSlice[] = entity.education
    ? [
        {
          key: "tertiary",
          label: t("census_metric_edu_tertiary"),
          value: entity.education.tertiary,
          color: EDUCATION_COLORS.tertiary,
        },
        {
          key: "upperSecondary",
          label: t("census_edu_upper_secondary"),
          value: entity.education.upperSecondary,
          color: EDUCATION_COLORS.upperSecondary,
        },
        {
          key: "lowerSecondary",
          label: t("census_edu_lower_secondary"),
          value: entity.education.lowerSecondary,
          color: EDUCATION_COLORS.lowerSecondary,
        },
        {
          key: "primaryOrLower",
          label: t("census_metric_edu_primary_or_lower"),
          value: entity.education.primaryOrLower,
          color: EDUCATION_COLORS.primaryOrLower,
        },
        {
          key: "preSchool",
          label: t("census_edu_pre_school"),
          value: entity.education.preSchool,
          color: EDUCATION_COLORS.preSchool,
        },
      ]
    : [];

  const ageSlices: StackedBarSlice[] = entity.age
    ? [
        {
          key: "0_14",
          label: t("census_age_0_14"),
          value: entity.age.age0_14,
          color: AGE_COLORS[0],
        },
        {
          key: "15_29",
          label: t("census_age_15_29"),
          value: entity.age.age15_29,
          color: AGE_COLORS[1],
        },
        {
          key: "30_44",
          label: t("census_age_30_44"),
          value: entity.age.age30_44,
          color: AGE_COLORS[2],
        },
        {
          key: "45_64",
          label: t("census_age_45_64"),
          value: entity.age.age45_64,
          color: AGE_COLORS[3],
        },
        {
          key: "65plus",
          label: t("census_metric_age_65plus"),
          value: entity.age.age65plus,
          color: AGE_COLORS[4],
        },
      ]
    : [];

  const genderSlices: StackedBarSlice[] = entity.gender
    ? [
        {
          key: "male",
          label: t("census_gender_male"),
          value: entity.gender.male,
          color: GENDER_COLORS.male,
        },
        {
          key: "female",
          label: t("census_gender_female"),
          value: entity.gender.female,
          color: GENDER_COLORS.female,
        },
      ]
    : [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
      {ethnicSlices.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            {t("census_section_ethnic")}
          </h3>
          <StackedBar slices={ethnicSlices} />
        </div>
      )}
      {religionSlices.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            {t("census_section_religion")}
          </h3>
          <StackedBar slices={religionSlices} />
        </div>
      )}
      {educationSlices.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            {t("census_section_education")}
          </h3>
          <StackedBar slices={educationSlices} />
        </div>
      )}
      {!compact && ageSlices.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            {t("census_section_age")}
          </h3>
          <StackedBar slices={ageSlices} />
        </div>
      )}
      {!compact && genderSlices.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            {t("census_section_gender")}
          </h3>
          <StackedBar slices={genderSlices} />
        </div>
      )}
    </div>
  );
};

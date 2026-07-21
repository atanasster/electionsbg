// The legacy name-keyed MP-connections graph is retired (person-candidate-merge follow-up):
// connections now live on the person layer (EIK-exact, all persons) in the dashboard's
// "Свързани лица" section. This route redirects to the candidate's dashboard, anchored to that
// section, so every inbound /candidate/:id/connections link keeps working.
import { FC } from "react";
import { Navigate, useParams } from "react-router-dom";

export const CandidateConnectionsScreen: FC = () => {
  const { id } = useParams();
  return (
    <Navigate
      to={{ pathname: `/candidate/${id}`, hash: "person-connections" }}
      replace
    />
  );
};

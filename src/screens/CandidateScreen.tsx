import { useParams } from "react-router-dom";
import { Candidate } from "./components/candidates/Candidate";

export const CandidateScreen = () => {
  const { id: name } = useParams();

  return <div className="w-full">{name && <Candidate name={name} />}</div>;
};

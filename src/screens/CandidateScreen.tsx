import { useParams } from "react-router-dom";
import { Candidate } from "./components/candidates/Candidate";

export const CandidateScreen = () => {
  const { id: name } = useParams();

  return (
    <div className={`w-full px-4 md:px-8`}>
      {name && <Candidate name={name} />}
    </div>
  );
};

import { useParams } from "react-router-dom";
import { Candidate } from "./components/candidates/Candidate";

export const CandidateScreen = () => {
  const { id: name } = useParams();

  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      {name && <Candidate name={name} />}
    </div>
  );
};

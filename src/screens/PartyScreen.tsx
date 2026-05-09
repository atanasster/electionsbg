import { useParams } from "react-router-dom";
import { Party } from "./components/party/Party";

export const PartyScreen = () => {
  const { id: nickName } = useParams();

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pb-12">
      {nickName && <Party nickName={nickName} />}
    </div>
  );
};

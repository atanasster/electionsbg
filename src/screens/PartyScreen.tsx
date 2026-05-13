import { useParams } from "react-router-dom";
import { Party } from "./components/party/Party";

export const PartyScreen = () => {
  const { id: nickName } = useParams();

  return (
    <div className="w-full pb-12">
      {nickName && <Party nickName={nickName} />}
    </div>
  );
};

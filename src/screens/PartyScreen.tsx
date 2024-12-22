import { useParams } from "react-router-dom";
import { Party } from "./components/party/Party";

export const PartyScreen = () => {
  const { id: nickName } = useParams();

  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      {nickName && <Party nickName={nickName} />}
    </div>
  );
};

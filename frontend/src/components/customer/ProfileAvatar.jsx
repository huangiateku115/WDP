import {useEffect, useState} from 'react';
import {UserRound} from 'lucide-react';

function avatarSource(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export default function ProfileAvatar({savedUrl}) {
  const source = avatarSource(savedUrl);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [source]);
  return (
    <div className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-[#EAF5EE] text-[#176B3A]">
      {source && !imageFailed ? (
        <img src={source} alt="Profile avatar" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setImageFailed(true)}/>
      ) : <UserRound size={40} role="img" aria-label="Default profile avatar"/>}
    </div>
  );
}

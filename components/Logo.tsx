import Image from 'next/image';

export default function Logo() {
  return (
    <div className="h-6 w-[82.372px]">
      <Image
        src="/icons/monty-logo.svg"
        alt="Monty"
        width={82.372}
        height={24}
        className="w-full h-full"
      />
    </div>
  );
}

import StudioPlus from "@/components/venus/StudioPlus";

// Studio+ (edit your own video, videos up to 60 minutes) is available on every Venus Pro screen.
export default function VenusLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <StudioPlus />
    </>
  );
}

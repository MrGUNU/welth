import HeroSection from "@/components/hero";
import { statsData } from "./data/landing";


export default function Home() {
  return (
    <div className="mt-40">
      <HeroSection />  

      <section>
        <div>
          <div>
            {statsData.map((statsData, index)=>(
              <div key={index}>
                <div>{statsData.value}</div>
                <div>{statsData.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

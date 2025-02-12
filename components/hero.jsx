"use client";

import { Button } from "./ui/button";

export const HeroSection = () => {
  return (
    <div className="pb-20 px-4">
        <div>
            <h1>
                Manage Your Finances <br /> with Intelligence
            </h1>
            <p>
                An AI-powered financial management platform that helps you track,
                analyze, and optimize your spending with real-time insights.
            </p>
            <div>
                <Link href="/dashboard">
                <Button size="lg" className="px-8">Get Started</Button>
                </Link>
            </div>
        </div>
    </div>
  )
}

export default HeroSection;

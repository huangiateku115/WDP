import {useState} from 'react';
import facilityApi from '@/api/facilityApi';
import {useBackend,rows} from '@/components/customer/RentalBackendUI';
import HeroSection from "@/components/home/HeroSection";
import StorageNeedsSection from "@/components/home/StorageNeedsSection";
import StorageSolutionsSection from "@/components/home/StorageSolutionsSection";
import WhyVaultSpaceSection from "@/components/home/WhyVaultSpaceSection";
import SizeGuideSection from "@/components/home/SizeGuideSection";
import FacilitiesSection from "@/components/home/FacilitiesSection";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import TestimonialsSection from "@/components/home/TestimonialsSection";
import FAQSection from "@/components/home/FAQSection";
import CTASection from "@/components/home/CTASection";
export default function HomePage(){const facilities=useBackend(config=>facilityApi.publicList({...config,params:{page:1,limit:6}}).then(rows),[],true);const [selected,setSelected]=useState('');return <div className="overflow-hidden bg-[#FAFAF7]"><HeroSection facilities={facilities} selected={selected} onSelect={setSelected}/><StorageNeedsSection/><StorageSolutionsSection/><WhyVaultSpaceSection/><SizeGuideSection/><FacilitiesSection resource={facilities}/><HowItWorksSection/><TestimonialsSection/><FAQSection/><CTASection/></div>}

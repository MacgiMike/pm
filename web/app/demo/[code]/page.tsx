'use client';
import { useParams } from 'next/navigation';
import { DemoEntry } from '@/components/demo';

export default function PartnerDemoPage() {
  const { code } = useParams<{ code: string }>();
  return <DemoEntry demoKey={code} />;
}

import { HeartPulse } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getMe } from "../../api/adminApi";
import { getErrorMessage } from "../../api/client";
import {
  getMemberProgress,
  logMemberActivity,
  logMemberWater,
  logMemberWeight } from "../../api/memberApi";
import { Button, Card, useToast } from "../../components/ui";
import { fieldClass } from "./roleHelpers";

export default function MemberProgressPage() {
  const toast = useToast();
  const { setProfile } = useOutletContext();
  const [progress, setProgress] = useState(null);
  const [waterMlInput, setWaterMlInput] = useState("250");
  const [weightInput, setWeightInput] = useState("");
  const [activityType, setActivityType] = useState("Walking");
  const [activityMinutes, setActivityMinutes] = useState("30");
  const [activityCalories, setActivityCalories] = useState("");
  const [logging, setLogging] = useState("");

  const load = useCallback(async () => {
    const [meData, progressData] = await Promise.all([
      getMe().catch(() => null),
      getMemberProgress().catch(() => null),
    ]);
    if (meData?.user) {
      setProfile?.(meData.user);
      const w = meData.user.clientData?.weight;
      if (w != null && w !== "") setWeightInput(String(w));
    }
    setProgress(progressData);
  }, [setProfile]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitWater(event) {
    event.preventDefault();
    const amount = Number(waterMlInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter water amount in ml");
      return;
    }
    setLogging("water");
    try {
      await logMemberWater(amount);
      toast.success(`Logged ${amount} ml water`);
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLogging("");
    }
  }

  async function submitWeight(event) {
    event.preventDefault();
    const weight = Number(weightInput);
    if (!Number.isFinite(weight) || weight < 20 || weight > 300) {
      toast.error("Weight must be between 20 kg and 300 kg.");
      return;
    }
    setLogging("weight");
    try {
      await logMemberWeight(weight);
      toast.success(`Weight updated to ${weight} kg`);
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLogging("");
    }
  }

  async function submitActivity(event) {
    event.preventDefault();
    const minutes = Number(activityMinutes);
    if (!activityType.trim() || !Number.isFinite(minutes) || minutes <= 0) {
      toast.error("Enter activity type and minutes");
      return;
    }
    setLogging("activity");
    try {
      await logMemberActivity({
        activityType: activityType.trim(),
        durationMinutes: minutes,
        caloriesBurned: activityCalories === "" ? 0 : Number(activityCalories) });
      toast.success("Activity logged");
      setActivityCalories("");
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLogging("");
    }
  }

  return (
    <Card className="p-6">
      <HeartPulse className="h-6 w-6 text-[var(--vf-primary)]" />
      <h1 className="mt-4 text-2xl font-bold">Log your progress</h1>
      <p className="mt-2 text-sm text-[var(--vf-muted)]">
        Record water, weight, and activity so your dashboard and share cards stay up to date.
      </p>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <form onSubmit={submitWater} className="rounded-[12px] border border-[var(--vf-border)] p-4">
          <p className="text-sm font-semibold">Water (ml)</p>
          <input
            type="number"
            min="1"
            value={waterMlInput}
            onChange={(e) => setWaterMlInput(e.target.value)}
            className={fieldClass}
            placeholder="250"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {[250, 500, 750].map((ml) => (
              <Button key={ml} type="button" size="sm" variant="secondary" onClick={() => setWaterMlInput(String(ml))}>
                {ml}
              </Button>
            ))}
          </div>
          <Button type="submit" className="mt-3 w-full" size="sm" disabled={logging === "water"}>
            {"Log water"}
          </Button>
        </form>

        <form onSubmit={submitWeight} className="rounded-[12px] border border-[var(--vf-border)] p-4">
          <p className="text-sm font-semibold">Weight (kg)</p>
          <input
            type="number"
            min="20"
            max="300"
            step="0.1"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            className={fieldClass}
            placeholder="70"
          />
          <p className="mt-2 text-xs text-[var(--vf-muted)]">
            Current: {progress?.summary?.weightKg ?? "—"} kg
            {progress?.summary?.bmi != null
              ? ` · BMI ${progress.summary.bmi}${progress?.summary?.bmiCategory ? ` (${progress.summary.bmiCategory})` : ""}`
              : ""}
          </p>
          <Button type="submit" className="mt-3 w-full" size="sm" disabled={logging === "weight"}>
            {"Log weight"}
          </Button>
        </form>

        <form onSubmit={submitActivity} className="rounded-[12px] border border-[var(--vf-border)] p-4">
          <p className="text-sm font-semibold">Activity</p>
          <label className="mt-2 block text-xs text-[var(--vf-muted)]">
            Type
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className={fieldClass}>
              {["Walking", "Running", "Cycling", "Gym", "Yoga", "Other"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-xs text-[var(--vf-muted)]">
            Minutes
            <input
              type="number"
              min="1"
              value={activityMinutes}
              onChange={(e) => setActivityMinutes(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="mt-2 block text-xs text-[var(--vf-muted)]">
            Calories (optional)
            <input
              type="number"
              min="0"
              value={activityCalories}
              onChange={(e) => setActivityCalories(e.target.value)}
              className={fieldClass}
              placeholder="0"
            />
          </label>
          <Button type="submit" className="mt-3 w-full" size="sm" disabled={logging === "activity"}>
            {"Log activity"}
          </Button>
        </form>
      </div>
    </Card>
  );
}

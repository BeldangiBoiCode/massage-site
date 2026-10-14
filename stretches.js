// Free starter stretches shown on the customer profile. Static content, no backend.
// General wellness tips only, not medical advice. Each area: a few gentle stretches with simple steps.
const STRETCH_NOTE = 'Move slowly and breathe. A gentle pull is fine; stop if you feel sharp pain, numbness or tingling. If pain is new, severe or lasting, check with a doctor.';

const STRETCHES = [
  { area: 'Neck', icon: '🧣', items: [
    { name: 'Ear to shoulder', hold: '30 sec each side', steps: 'Sit tall and let your shoulders drop. Tilt your right ear toward your right shoulder. Rest your right hand lightly on your head for a little extra weight, no pulling. Switch sides.' },
    { name: 'Chin tuck', hold: '5 sec, 10 times', steps: 'Look straight ahead. Glide your chin straight back like making a double chin, keeping your eyes level. Hold, then release. Great for desk neck.' },
    { name: 'Look down diagonal', hold: '30 sec each side', steps: 'Turn your nose toward your right armpit and let the weight of your head drop. Feel the stretch along the left back of your neck. Switch sides.' },
  ] },
  { area: 'Shoulders', icon: '💪', items: [
    { name: 'Cross-body arm stretch', hold: '30 sec each arm', steps: 'Bring your right arm across your chest. Hug it close with your left hand, just above the elbow. Keep your shoulder down, away from your ear.' },
    { name: 'Doorway chest opener', hold: '30 sec', steps: 'Stand in a doorway with your forearms on the frame, elbows at shoulder height. Step one foot forward and lean until you feel your chest and front shoulders open.' },
    { name: 'Shoulder rolls', hold: '10 slow rolls each way', steps: 'Lift your shoulders up, roll them back and down in a big smooth circle. Reverse the direction. Let your breathing set the pace.' },
  ] },
  { area: 'Upper back', icon: '🪽', items: [
    { name: 'Cat and cow', hold: '10 slow rounds', steps: 'On hands and knees, round your back toward the ceiling and tuck your chin (cat). Then lift your chest and tailbone and let your belly drop (cow). Move with your breath.' },
    { name: 'Thread the needle', hold: '30 sec each side', steps: 'From hands and knees, slide your right arm under your left arm, palm up, and rest your shoulder and ear on the floor. Reach your left arm forward. Switch sides.' },
    { name: 'Wall angels', hold: '10 slow reps', steps: 'Stand with your back near a wall, elbows bent at shoulder height. Slide your arms up and down like a snow angel, keeping contact with the wall as much as is comfortable.' },
  ] },
  { area: 'Lower back', icon: '🌉', items: [
    { name: 'Knees to chest', hold: '30 sec', steps: 'Lie on your back. Hug both knees toward your chest and let your lower back flatten and relax into the floor. Rock gently side to side if it feels good.' },
    { name: 'Lying knee drop', hold: '30 sec each side', steps: 'Lie on your back with knees bent and arms out wide. Let both knees fall to the right while your shoulders stay down. Switch sides.' },
    { name: "Child's pose", hold: '45 sec', steps: 'Kneel, sit your hips back toward your heels and reach your arms forward on the floor. Breathe into your lower back. Widen your knees if it feels better.' },
  ] },
  { area: 'Hips', icon: '🦋', items: [
    { name: 'Figure-four stretch', hold: '30 sec each side', steps: 'Lie on your back with knees bent. Cross your right ankle over your left knee. Pull the left thigh gently toward you until you feel the right hip and glute open.' },
    { name: 'Low lunge', hold: '30 sec each side', steps: 'Step one foot far forward and lower your back knee to the floor (pad it with a towel). Tuck your tailbone slightly and shift forward to open the front of the back hip.' },
    { name: 'Butterfly', hold: '45 sec', steps: 'Sit tall with the soles of your feet together and knees falling out to the sides. Hinge forward from the hips only as far as feels comfortable.' },
  ] },
  { area: 'Legs', icon: '🦵', items: [
    { name: 'Standing quad stretch', hold: '30 sec each leg', steps: 'Hold a wall for balance. Bend one knee and bring your heel toward your glute, holding your ankle. Keep your knees close together and stand tall.' },
    { name: 'Hamstring stretch', hold: '30 sec each leg', steps: 'Sit on the floor with one leg straight and the other bent. Keep your back long and lean forward from the hips until you feel the back of the thigh.' },
    { name: 'Calf wall stretch', hold: '30 sec each leg', steps: 'Face a wall with hands on it. Step one foot back, heel down, and press your hips forward until you feel the calf. Bend the back knee slightly to reach the lower calf.' },
  ] },
  { area: 'Wrists & forearms', icon: '🖐️', items: [
    { name: 'Prayer stretch', hold: '20 sec', steps: 'Press your palms together in front of your chest. Slowly lower your hands toward your waist, keeping your palms touching, until you feel your wrists and forearms.' },
    { name: 'Wrist flexor stretch', hold: '20 sec each hand', steps: 'Extend one arm in front of you, palm up. With the other hand, gently pull your fingers back toward you. Keep the elbow soft.' },
    { name: 'Tendon glides', hold: '10 slow rounds', steps: 'Go through hand positions slowly: straight fingers, hook, full fist, tabletop, straight again. Good after long typing or phone use.' },
  ] },
  { area: 'Feet', icon: '🦶', items: [
    { name: 'Plantar fascia roll', hold: '1 minute each foot', steps: 'Sit on a chair and roll the arch of your foot over a tennis ball or water bottle with gentle pressure. Slow down on tender spots and breathe.' },
    { name: 'Toe stretch', hold: '30 sec each foot', steps: 'Kneel with your toes tucked under and sit back slightly on your heels. Use your hands on the floor to control how much weight you put through your feet.' },
    { name: 'Ankle circles', hold: '10 each way, each foot', steps: 'Sit and lift one foot. Draw slow, big circles with your toes in each direction, moving only your ankle.' },
  ] },
];
